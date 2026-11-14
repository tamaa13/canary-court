"use client";
// The vault story, and the page's hero. One pinned stage; the scroll moves through a rendered film (nothing plays on its
// own): the key's teeth, the key inside its vault, the vault turning to three-quarter view as the room goes dark. The
// page opens on the hero (headline, lede, CTAs, live strip) beside the film's first frame; it lifts away as the film
// starts, and three statements rise and fade in turn. The stage follows the scroll with a short lag, so native scrolling (wheel, keys, touch) stays.
// Reduced motion: no lag and no scrub. The film rests on three stills that cross-fade, and the words only fade.
// Before the first frame decodes, the poster (f000) holds the stage, at the same box, so nothing shifts.
// Video captures: ?capture=1 drops the lag and exposes window.__cc (wait for __cc.ready, then storyAt(screens), which
// resolves once the exact frame for that position is decoded and drawn; see the effect).
// Leaving from the hero (lib/travel.ts), the film itself is the way through, run by time instead of scroll: it scrubs fast
// to the vault (seen from above for joining, at three-quarters for the market), then the camera zooms into the vault's
// dark (TRAVEL_INTO in content/story.ts) while the page's night takes over from about 3× (raster frames never get to
// look upscaled), and the next page emerges from that dark.

import { useEffect, useRef, type ReactNode } from "react";
import { Heading, Label, Text } from "@/components/atoms";
import { FILM_WIDE, FRAME_AT, GROUND_AT, HERO, MARKS, PHONE_SHIFT_AT, PLATE, SPAN, STACKED_FEATHER, TRAVEL_INTO, film as spec, poster, scenes } from "@/content/story";
import { Film, paint, type Pair } from "@/lib/frames";
import { along, ease, easeOut, follower, mixRGB, rgb, seg, type RGB } from "@/lib/scrub";
import { registerStory, resetPullBack, type TravelKind } from "@/lib/travel";

const PAPER: RGB = [246, 245, 241];
const NIGHT: RGB = [18, 18, 20];
const INK: RGB = [23, 23, 26];
const INK_NIGHT: RGB = [242, 240, 234];
/** the dark theme's paper (dusk) and its ink: the story starts there instead (globals.css --dusk, --ink-dusk) */
const DUSK: RGB = [26, 26, 29];
const INK_DUSK: RGB = [236, 233, 225];
/** reduced motion: the stills hand over in a short cross-fade (screens either side of the next scene's arrival), not a
 *  long double exposure */
const RM_FADE = 0.12;
/** the wide layout (words left, film right); anything else stacks the words above the film. Same query as the `wide:` variant */
const WIDE = "(min-width: 1024px) and (min-aspect-ratio: 4/5)";

/** `hero`: the hero's words (a server component: the live strip's first read happens on the server) */
export function VaultStory({ hero }: { hero: ReactNode }) {
  const track = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useRef<HTMLImageElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const copy = useRef<(HTMLDivElement | null)[]>([]);
  const words = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLParagraphElement>(null);
  const heroEl = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tr = track.current;
    const st = stage.current;
    const bx = box.current;
    const cv = canvas.current;
    if (!tr || !st || !bx || !cv) return;
    const ctx = cv.getContext("2d", { alpha: true });
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wideQ = window.matchMedia(WIDE);
    // ?capture=1 (video captures): no lag, every frame fetched up front, and window.__cc.storyAt() below
    const capture = new URLSearchParams(window.location.search).get("capture") === "1";

    let H = st.clientHeight;
    let y = 0; // where the scroll is (screens into the pin)
    let ys = 0; // where the stage is drawn (follows y)
    let raf = 0;
    let dirty = true;
    let near = false;
    let painted = "";
    let groundKey = "";
    let shiftNow = 0;
    /** stacked: how far the film sits pushed down under the hero (px), at full hero and right now */
    let push = 0;
    let pushNow = 0;
    /** the frames on the canvas now */
    let drawn = { ia: -1, ib: -1 };
    /** the plate, as insets of the film box (px): where the clip sits while the frames are opaque */
    let plate = { top: 0, right: 0, bottom: 0, left: 0 };
    /** where the plate's caption sits (px in the stage): moved by a transform, so a re-measure never counts as a shift */
    let capAt = { x: 0, y: 0 };
    const follow = follower(0.09);
    /** a run away from the hero (lib/travel.ts): which way, since when, for how long, from which frame; the night layer
     *  it fades in, and what to call once the screen is dark */
    let tv: { kind: TravelKind; t0: number; ms: number; from: number; dark: HTMLElement; covered: () => void; done: boolean } | null = null;
    const shown = new WeakMap<HTMLElement, string>();
    // (a page restored with its last pull-back still on, from a cache: put it back)
    resetPullBack();

    if (process.env.NODE_ENV !== "production" && PLATE.enabled && along(FRAME_AT, PLATE.open[0]) < PLATE.cleanFrom)
      console.warn(`story: the plate opens at f${Math.floor(along(FRAME_AT, PLATE.open[0]))}, before the first clean frame f${PLATE.cleanFrom}`);

    const film = new Film(
      spec,
      () => {
        dirty = true;
        kick();
      },
      () => cv.width,
    );

    const style = (el: HTMLElement | null, key: string, apply: (s: CSSStyleDeclaration) => void) => {
      if (!el || shown.get(el) === key) return;
      shown.set(el, key);
      apply(el.style);
    };

    const measure = () => {
      H = Math.max(1, st.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(bx.clientWidth * dpr);
      const h = Math.round(bx.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        painted = "";
      }
      // the plate, in the stage's coordinates, then as insets of the box (the box's own shift taken out)
      const sr = st.getBoundingClientRect();
      const br = bx.getBoundingClientRect();
      const bl = br.left - sr.left - shiftNow * bx.offsetWidth;
      const bt = br.top - sr.top - pushNow;
      const W = sr.width;
      const gut = words.current ? parseFloat(getComputedStyle(words.current).paddingLeft) || 16 : 16;
      let p: { l: number; t: number; r: number; b: number };
      if (wideQ.matches) {
        const right = Math.max(0, ...[...copy.current, heroEl.current].map((el) => (el ? el.getBoundingClientRect().right - sr.left : 0)));
        p = { l: Math.max(right + 56, W * 0.44), t: Math.max(56, H * 0.08), r: W - gut, b: H - 76 };
      } else {
        const area = bx.parentElement!.getBoundingClientRect();
        // (its bottom leaves a line for the caption above the story's counter)
        p = { l: gut, t: area.top - sr.top, r: W - gut, b: area.bottom - sr.top - 26 };
      }
      // (the plate never reaches past the film itself: on a phone the film can be shorter than its area)
      p = { l: Math.max(p.l, bl), t: Math.max(p.t, bt), r: Math.min(p.r, bl + bx.offsetWidth), b: Math.min(p.b, bt + bx.offsetHeight) };
      plate = {
        top: p.t - bt,
        left: p.l - bl,
        right: bl + bx.offsetWidth - p.r,
        bottom: bt + bx.offsetHeight - p.b,
      };
      // stacked: the hero sits above the film's area and may run past its top; the film is pushed down under it while it
      // shows (a transform: nothing else moves)
      const he = heroEl.current;
      push = !wideQ.matches && he ? Math.max(0, he.offsetTop + he.offsetHeight + 24 - p.t) : 0;
      const cap = caption.current;
      if (cap) {
        capAt = { x: Math.round(p.l), y: Math.round(p.b + 10) };
        cap.style.maxWidth = `${p.r - p.l}px`;
        // (hidden until placed here: drawn at the stage's corner first, it would count as a layout shift)
        cap.style.visibility = "visible";
      }
      dirty = true;
    };

    // (read from the track's box every time: anything above it may change height after mount: fonts, the live strip)
    const target = () => Math.min(SPAN, Math.max(0, -tr.getBoundingClientRect().top / H));

    const render = (t: number) => {
      // the ground: paper, then night while the vault turns; every token the words read is mixed with it
      const g = ease(along(GROUND_AT, t));
      const dark = document.documentElement.dataset.theme === "dark";
      const bg = mixRGB(dark ? DUSK : PAPER, NIGHT, g);
      const fg = mixRGB(dark ? INK_DUSK : INK, INK_NIGHT, g);
      const gk = `${rgb(bg)}${rgb(fg)}`;
      if (gk !== groundKey) {
        groundKey = gk;
        const s = tr.style;
        s.setProperty("--bg", rgb(bg));
        s.setProperty("--fg", rgb(fg));
        s.setProperty("--fg-2", rgb(fg, 0.68));
        s.setProperty("--fg-3", rgb(fg, 0.6));
        s.setProperty("--rule", rgb(fg, 0.14));
        s.setProperty("--rule-strong", rgb(fg, 0.34));
      }

      // the film
      let pair: Pair | null;
      if (rm) {
        // three stills, cross-faded where one scene's words hand over to the next
        let k = 0;
        while (k < scenes.length - 1 && t >= scenes[k]!.out[0]) k++;
        const prev = scenes[Math.max(0, k - 1)]!;
        const cur = scenes[k]!;
        const mix = k === 0 ? 1 : seg(t, cur.in[0] - RM_FADE, cur.in[0] + RM_FADE);
        pair = film.pair(prev.still, cur.still, mix);
        film.aim(cur.still);
      } else {
        pair = film.at(along(FRAME_AT, t));
      }
      // a run away from the hero: the first half scrubs to the vault, the second zooms into its dark
      let zoom = 1;
      let into = 0;
      let runFrame = -1;
      if (tv && !rm) {
        const way = TRAVEL_INTO[tv.kind];
        const u = Math.min(1, (performance.now() - tv.t0) / tv.ms);
        const us = Math.min(1, u / way.scrub);
        runFrame = tv.from + (way.frame - tv.from) * (us * us * (3 - 2 * us));
        pair = film.at(runFrame);
        const uz = Math.max(0, (u - way.scrub) / (1 - way.scrub));
        zoom = Math.exp(Math.log(way.zoom) * uz * uz);
        // (the night takes over from ~3×, before the frame's pixels could look upscaled)
        into = Math.min(1, Math.max(0, Math.log(zoom / 2.6) / Math.log(way.zoom / 2.6)));
        tv.dark.style.opacity = (into * into * (3 - 2 * into)).toFixed(3);
        if (u >= 1 && !tv.done) {
          tv.done = true;
          tv.dark.style.opacity = "1";
          tv.covered();
        }
      }
      if (ctx && pair) {
        const key = `${pair.ia}|${pair.ib}|${pair.mix.toFixed(3)}|${cv.width}`;
        if (key !== painted) {
          paint(ctx, pair, cv.width, cv.height);
          painted = key;
          drawn = { ia: pair.ia, ib: pair.ib };
          // the poster steps back once the film has a frame on the canvas
          style(still.current, "off", (s) => (s.visibility = "hidden"));
        }
      }
      const shift = wideQ.matches ? 0 : along(PHONE_SHIFT_AT, t);
      shiftNow = shift;

      // the hero: lifts and fades as the story starts; once gone it takes no clicks and no focus
      const ho = seg(t, HERO.out[0], HERO.out[1]);
      const hv = 1 - ho;
      const hdy = rm ? 0 : -easeOut(ho) * 36;
      const he = heroEl.current;
      style(he, `${hv.toFixed(3)}|${hdy.toFixed(1)}`, (s) => {
        s.opacity = hv.toFixed(3);
        s.transform = hdy ? `translate3d(0, ${hdy.toFixed(1)}px, 0)` : "";
        s.pointerEvents = hv > 0.6 ? "" : "none";
      });
      if (he && he.inert !== hv < 0.05) he.inert = hv < 0.05;
      // (the film rises into its own place only once the hero is mostly gone: never under its fading words)
      pushNow = rm ? (ho >= 1 ? 0 : push) : push * (1 - ease(seg(t, HERO.out[0] + 0.14, HERO.out[1] + 0.14)));
      style(counter.current, seg(t, 0.3, 0.6).toFixed(3), (s) => (s.opacity = seg(t, 0.3, 0.6).toFixed(3)));
      // the plate: clipped while the frames are opaque, opening to full bleed (in one step for reduced motion, once
      // the still behind it has cross-faded to a clean frame)
      const open = !PLATE.enabled ? 1 : rm ? (t >= (scenes[1]?.in[0] ?? 0) + RM_FADE ? 1 : 0) : ease(seg(t, PLATE.open[0], PLATE.open[1]));
      // (on the run the plate opens as the frames turn clean, so the vault isn't boxed in)
      const k = (1 - open) * (runFrame >= 0 ? 1 - ease(seg(runFrame, 70, 92)) : 1);
      const clip = k > 0.001 ? `inset(${(plate.top * k).toFixed(1)}px ${(plate.right * k).toFixed(1)}px ${(plate.bottom * k).toFixed(1)}px ${(plate.left * k).toFixed(1)}px)` : "none";
      // (stacked: the film's top and bottom edges feather out as the plate opens; framed, they stay crisp)
      const feather = wideQ.matches ? 0 : STACKED_FEATHER * open;
      const mask = feather > 0.001 ? `linear-gradient(to bottom, transparent 0%, #000 ${(feather * 100).toFixed(1)}%, #000 ${(100 - feather * 100).toFixed(1)}%, transparent 100%)` : "none";
      style(bx, `${shift.toFixed(4)}|${pushNow.toFixed(1)}|${zoom.toFixed(4)}|${clip}|${mask}`, (s) => {
        const move = shift || pushNow ? `translate3d(${(shift * 100).toFixed(2)}%, ${pushNow.toFixed(1)}px, 0)` : "";
        s.transform = zoom !== 1 ? `${move} scale(${zoom.toFixed(4)})`.trim() : move;
        s.clipPath = clip;
        s.maskImage = mask;
        s.setProperty("-webkit-mask-image", mask);
      });
      style(caption.current, `${k.toFixed(3)}|${pushNow.toFixed(1)}|${capAt.x}|${capAt.y}`, (s) => {
        s.opacity = (k * k).toFixed(3);
        s.transform = `translate3d(${capAt.x}px, ${(capAt.y + pushNow).toFixed(1)}px, 0)`;
      });

      // the words: rise and fade in, lift and fade out
      let active = 0;
      scenes.forEach((sc, i) => {
        const a = seg(t, sc.in[0], sc.in[1]);
        const o = seg(t, sc.out[0], sc.out[1]);
        const v = a * (1 - o);
        // (the counter names the latest scene to have come in, so the gaps between scenes keep the last one)
        if (a > 0.5) active = i;
        const dy = rm ? 0 : (1 - easeOut(a)) * 28 - easeOut(o) * 22;
        style(copy.current[i] ?? null, `${v.toFixed(3)}|${dy.toFixed(1)}`, (s) => {
          s.opacity = v.toFixed(3);
          s.transform = dy ? `translate3d(0, ${dy.toFixed(1)}px, 0)` : "";
        });
      });
      style(rail.current, (t / SPAN).toFixed(4), (s) => (s.transform = `scaleX(${(t / SPAN).toFixed(4)})`));
    };

    const tick = (now: number) => {
      const before = ys;
      ys = follow(ys, y, now, rm || capture);
      if (ys !== before || dirty || tv) render(ys);
      dirty = false;
      raf = ys !== y || (tv && !tv.done) ? requestAnimationFrame(tick) : 0;
    };
    function kick() {
      if (!raf) raf = requestAnimationFrame(tick);
    }
    const onScroll = () => {
      if (!near) return;
      y = target();
      kick();
    };

    // fetch the anchors once the page is idle; everything else when the story is a screen away
    const idle = window.requestIdleCallback?.(() => film.prime(), { timeout: 2500 }) ?? window.setTimeout(() => film.prime(), 1200);
    const io = new IntersectionObserver(
      ([e]) => {
        near = !!e?.isIntersecting;
        if (near) {
          film.fetchAll();
          y = target();
          dirty = true;
          kick();
        }
      },
      { rootMargin: "100% 0px 100% 0px" },
    );
    io.observe(tr);
    const ro = new ResizeObserver(() => {
      measure();
      y = ys = target();
      kick();
    });
    ro.observe(st);
    ro.observe(bx);
    measure();
    y = ys = target();
    render(ys);
    tr.dataset.ready = "";
    window.addEventListener("scroll", onScroll, { passive: true });

    // the runner lib/travel.ts calls on a choice in the hero: only while the hero is what's on screen
    registerStory((kind, ms, dark, covered) => {
      if (rm || capture || !near || ys > HERO.out[0]) return false;
      const way = TRAVEL_INTO[kind];
      const from = along(FRAME_AT, ys);
      // (the frames on the way, sparse first, then the destination's neighbours: the film blends whatever is decoded)
      const need: number[] = [];
      for (let f = Math.ceil(from); f < way.frame; f += 6) need.push(f);
      film.ensure([way.frame, way.frame - 1, way.frame + 1, ...need]);
      bx.style.transformOrigin = `${(way.at.x * 100).toFixed(1)}% ${(way.at.y * 100).toFixed(1)}%`;
      tv = { kind, t0: performance.now(), ms, from, dark, covered, done: false };
      kick();
      return true;
    });
    wideQ.addEventListener("change", measure);
    // (the theme switched: the ground's two ends change, so the story repaints its tokens)
    const themeWatch = new MutationObserver(() => {
      groundKey = "";
      dirty = true;
      kick();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });


    // the frames a position draws: its two neighbours on the film (one if it lands on a frame), or for reduced motion
    // the two stills being cross-faded
    const framesFor = (t: number): [number, number] => {
      if (rm) {
        let k = 0;
        while (k < scenes.length - 1 && t >= scenes[k]!.out[0]) k++;
        const prev = scenes[Math.max(0, k - 1)]!.still;
        const cur = scenes[k]!.still;
        const mix = k === 0 ? 1 : seg(t, scenes[k]!.in[0] - RM_FADE, scenes[k]!.in[0] + RM_FADE);
        return mix <= 0 ? [prev, prev] : mix >= 1 ? [cur, cur] : [prev, cur];
      }
      const f = Math.min(spec.n - 1, Math.max(0, along(FRAME_AT, t)));
      return [Math.floor(f), Math.ceil(f)];
    };
    /** Scroll the story to `screens` (0 → SPAN) and resolve once the exact frames for that position are decoded and on
     *  the canvas (never a stand-in blend of farther neighbours), the fonts are in, and a frame has been presented. */
    const storyAt = (screens: number) =>
      new Promise<{ t: number; frame: number; frames: [number, number] }>((resolve, reject) => {
        // (a call without a number never scrolls: e.g. Playwright's waitForFunction('__cc.storyAt') invokes the function)
        if (typeof screens !== "number" || !Number.isFinite(screens)) return reject(new TypeError(`storyAt(screens): a number of screens, 0 to ${SPAN}`));
        near = true;
        film.fetchAll();
        const top = tr.getBoundingClientRect().top + window.scrollY;
        // (rounded up, past float noise: the stage is always fully pinned at exactly 0, never half a pixel off)
        window.scrollTo({ top: Math.ceil(top + Math.min(SPAN, Math.max(0, screens)) * H - 1e-6), behavior: "instant" });
        // (the position the stage reads after the scroll, whole pixels: the same viewport always lands the same way)
        const t = target();
        y = ys = t;
        const need = framesFor(t);
        film.ensure(need);
        const t0 = performance.now();
        const check = () => {
          dirty = true;
          render(ys);
          const exact = film.has(need[0]) && film.has(need[1]) && drawn.ia === need[0] && drawn.ib === need[1];
          if (exact)
            void document.fonts.ready.then(() =>
              requestAnimationFrame(() => resolve({ t, frame: rm ? need[1] : along(FRAME_AT, t), frames: need })),
            );
          else if (performance.now() - t0 > 30_000) reject(new Error(`storyAt(${screens}): frames ${need.join(",")} not decoded after 30 s`));
          else requestAnimationFrame(check);
        };
        check();
      });
    const w = window as Window & { __cc?: Record<string, unknown> };
    if (capture) {
      film.fetchAll();
      // wait on `window.__cc?.ready` (true), then call storyAt(screens)
      w.__cc = { ...w.__cc, ready: true, storyAt, story: { span: SPAN, frames: spec.n, marks: MARKS, frameAt: (t: number) => along(FRAME_AT, t) } };
    }

    return () => {
      themeWatch.disconnect();
      registerStory(null);
      film.dispose();
      cancelAnimationFrame(raf);
      if (window.cancelIdleCallback && typeof idle === "number") window.cancelIdleCallback(idle);
      window.clearTimeout(idle as number);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      wideQ.removeEventListener("change", measure);
      if (w.__cc?.storyAt === storyAt) {
        delete w.__cc.storyAt;
        delete w.__cc.ready;
      }
    };
  }, []);

  return (
    <section
      ref={track}
      data-ground="paper"
      aria-labelledby="hero-title"
      className="story relative"
      style={{ height: `${(SPAN + 1) * 100}svh` }}
    >
      <div ref={stage} className="sticky top-0 flex h-svh flex-col overflow-hidden">
        {/* the words. Stacked (phone, portrait): a block above the film, every scene in the same grid cell so the block is
            as tall as the longest one. Wide: a column on the left, vertically centred; the film never runs under it */}
        <div ref={words} className="wrap relative z-[1] grid shrink-0 pt-[clamp(64px,10svh,120px)] wide:absolute wide:inset-y-0 wide:left-1/2 wide:-translate-x-1/2 wide:items-center wide:pt-0">
          {scenes.map((s, i) => (
            <div
              key={s.title}
              ref={(el) => {
                copy.current[i] = el;
              }}
              className="story-copy max-w-[600px] opacity-0 will-change-transform [grid-area:1/1] wide:w-[min(34vw,560px)]"
            >
              <Heading level={2} size="head" id={`story-${i}`}>
                {s.title}
              </Heading>
              <Text size="lede" muted className="mt-5 max-w-[44ch]">
                {s.line}
              </Text>
            </div>
          ))}
        </div>

        {/* the film. Stacked: it fills what the words leave, 1.5x the screen's width at most (the sides bleed). Wide: as tall
            as the screen, centred on the right part (FILM_WIDE.centerX), bleeding off the right edge if it must */}
        <div className="relative mb-12 min-h-0 flex-1 [container-type:size] wide:absolute wide:inset-0 wide:mb-0">
          <div
            ref={box}
            style={{ ["--film-x" as string]: `${FILM_WIDE.centerX * 100}%` }}
            className="absolute left-1/2 top-1/2 aspect-[16/10] w-[min(150cqw,160cqh)] -translate-x-1/2 -translate-y-1/2 wide:left-[var(--film-x)] wide:w-[160cqh]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the exact frame file, unprocessed: it must match the film */}
            <img
              ref={still}
              src={poster.src}
              width={poster.w}
              height={poster.h}
              alt=""
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 size-full select-none"
            />
            <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />
          </div>
        </div>

        {/* the hero. Wide: the left column beside the film's first frame, vertically centred. Stacked: on top (clear of the
            header, which overlays the stage), the film pushed below it. Visible from the first paint, without script */}
        <div data-travel-fade className="wrap absolute inset-x-0 top-0 z-[2] pt-[clamp(76px,10svh,112px)] wide:inset-y-0 wide:flex wide:items-center wide:pt-0">
          <div ref={heroEl} className="w-full will-change-transform wide:w-[min(40vw,600px)]">
            {hero}
          </div>
        </div>

        {/* the plate's caption, under it while the film is framed (PLATE.enabled) */}
        <p ref={caption} hidden={!PLATE.enabled} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 z-[1] text-[13px] text-fg-2">
          {PLATE.caption}
        </p>

        {/* where we are in the story: a hairline that fills */}
        <div ref={counter} aria-hidden className="wrap absolute inset-x-0 bottom-0 opacity-0">
          <div className="flex items-center gap-4 pb-5">
            <div className="relative h-px flex-1 bg-rule">
              <div ref={rail} className="absolute inset-0 origin-left scale-x-0 bg-fg-2" />
            </div>
          </div>
        </div>
      </div>
      <p className="sr-only">
        Illustration: a close view of a key&apos;s teeth pulls back to show the key locked inside a cylinder within a vault, then
        the vault turns to a three-quarter view as the background goes dark.
      </p>
      <noscript>
        <style>{`.story-copy{opacity:1!important}.story-copy+.story-copy{display:none}`}</style>
      </noscript>
    </section>
  );
}
