"use client";
// A rendered object scrubbed by its own pass through the screen: a turntable (rt-3d's frames) that turns as you read,
// drifting a little slower than the text, caption and all (so the gap under the object never changes). The frame's
// empty bands above and below the object are trimmed from the layout (`bounds`): the transparent canvas simply
// overlaps them, nothing is clipped. Without frames yet (`film` null) it shows the poster, still. With `loop` (frames a
// second) a seamless 360° turntable turns on its own while it's near the screen instead, wrapping from the last frame to
// the first. Reduced motion: the still pose, no drift. Used by "How it works" (StepFigure) and the landing's lower
// sections.

import { useEffect, useRef } from "react";
import { Film, paint, type FilmSpec } from "@/lib/frames";
import { clamp01 } from "@/lib/scrub";

export type Poster = { src: string; w: number; h: number };

export function ScrubFigure({
  film: spec,
  poster,
  bounds = [0, 1],
  caption,
  loop,
  className,
}: {
  film: FilmSpec | null;
  /** a seamless turntable turning by time: frames per second */
  loop?: number;
  poster: Poster;
  /** where the object sits in the frame, top and bottom as fractions of its height */
  bounds?: readonly [number, number];
  caption?: string;
  className?: string;
}) {
  const outer = useRef<HTMLElement>(null);
  const drift = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const bx = box.current;
    const cv = canvas.current;
    const fig = outer.current;
    const dr = drift.current;
    if (!bx || !cv || !fig || !dr) return;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = spec ? cv.getContext("2d", { alpha: true }) : null;
    let raf = 0;
    let painted = "";
    let near = false;
    const film = spec ? new Film(spec, () => kick(), () => cv.width) : null;

    const t0 = performance.now();
    const draw = (now?: number) => {
      raf = 0;
      if (!near) return;
      // (measured on the figure, which never moves: the drift is inside it)
      const r = fig.getBoundingClientRect();
      const vh = window.innerHeight;
      // (0 as the figure enters at the bottom, 1 as it leaves at the top)
      const p = clamp01((vh - r.top) / (vh + r.height));
      let pair = null;
      if (film && spec && loop && !rm) {
        // (by time, wrapping: the last frame blends into the first; the next few frames are kept decoded ahead)
        const f = ((((now ?? performance.now()) - t0) / 1000) * loop) % spec.n;
        const a = Math.floor(f);
        film.aim(Math.min(spec.n - 1, a + 3));
        pair = film.pair(a, (a + 1) % spec.n, f - a) ?? film.at(a);
      } else if (film && spec) pair = film.at(rm ? 0 : p * (spec.n - 1));
      if (pair && ctx) {
        const key = `${pair.ia}|${pair.ib}|${pair.mix.toFixed(3)}|${cv.width}`;
        if (key !== painted) {
          paint(ctx, pair, cv.width, cv.height);
          painted = key;
          if (still.current) still.current.style.visibility = "hidden";
        }
      }
      const ty = rm ? 0 : (p - 0.5) * 40;
      dr.style.transform = ty ? `translate3d(0, ${ty.toFixed(1)}px, 0)` : "";
      // (a loop keeps turning while it's near; it stops by itself once it's far)
      if (loop && !rm && film) raf = requestAnimationFrame(draw);
    };
    function kick() {
      if (!raf) raf = requestAnimationFrame(draw);
    }
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(bx.clientWidth * dpr);
      cv.height = Math.round(bx.clientHeight * dpr);
      painted = "";
      kick();
    };
    // fetch when the figure is a screen away; let the decoded frames go when it's far
    const io = new IntersectionObserver(
      ([e]) => {
        near = !!e?.isIntersecting;
        if (near) {
          film?.fetchAll();
          kick();
        } else film?.release();
      },
      { rootMargin: "100% 0px 100% 0px" },
    );
    io.observe(fig);
    const ro = new ResizeObserver(size);
    ro.observe(bx);
    window.addEventListener("scroll", kick, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", kick);
      film?.dispose();
    };
    // (one film per figure for the life of the page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [top, bottom] = bounds;
  const ratio = (poster.h / poster.w) * 100;
  return (
    <figure ref={outer} className={className}>
      <div ref={drift} className="flex flex-col will-change-transform">
        {/* (margins in % of the width, so `ratio`% is the frame's height) */}
        <div
          ref={box}
          className="pointer-events-none relative w-full"
          style={{ aspectRatio: `${poster.w} / ${poster.h}`, marginTop: `${(-top * ratio).toFixed(2)}%`, marginBottom: `${(-(1 - bottom) * ratio).toFixed(2)}%` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- the exact rendered pose, unprocessed */}
          <img ref={still} src={poster.src} width={poster.w} height={poster.h} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full" />
          <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />
        </div>
        {caption ? <figcaption className="relative mt-4 text-[13px] leading-snug text-fg-2">{caption}</figcaption> : null}
      </div>
    </figure>
  );
}
