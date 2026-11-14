"use client";
// The page transition: into the hero's 3D film. A choice in the hero runs the story's film on its own (VaultStory): it
// scrubs fast to the vault (from above for "I have an agent", at three-quarters for "Watch the market"), then the camera
// zooms into the vault's dark while the page's night takes over and the header and the hero's words pull back (~700 ms).
// Once the screen is night the router navigates and the next page emerges from it: it scales 0.96 → 1 as it fades in
// while the night fades out (~300 ms; .cc-page wrappers and the [data-arrive] CSS in globals.css).
// Anywhere else (the header's Market and Join, the closing calls to action, the hero scrolled away): the arrival only,
// as a view transition typed "travel". Reduced motion: a 150 ms crossfade. Without view transitions: a plain
// navigation. Focus moves to the new page's h1 (TravelFocus).

import type { useRouter } from "next/navigation";
import { TRAVEL } from "./travel-type";

export { TRAVEL };

type Router = ReturnType<typeof useRouter>;
export type TravelKind = "join" | "market";
/** the story's runner: starts the film's run (fading `dark` in as it goes, calling `covered` once the screen is night)
 *  and says so, or says no (the hero isn't what's on screen, reduced motion…) */
type Runner = (kind: TravelKind, ms: number, dark: HTMLElement, covered: () => void) => boolean;

let runner: Runner | null = null;
export function registerStory(r: Runner | null) {
  runner = r;
}

/** the film's run into the vault's dark, and the emergence on the other side */
export const ZOOM_MS = 700;
export const EMERGE_MS = 300;

let busy = false;
let focusNext = false;
let overlay: HTMLDivElement | null = null;
let failsafe = 0;

/** a travel navigation is on its way: the next page's heading takes the focus once it's in (TravelFocus) */
export function markTravel() {
  focusNext = true;
}

export function takeTravelFocus(): boolean {
  const f = focusNext;
  focusNext = false;
  return f;
}

/** the elements the pull-back takes (the header and the hero's words: the film is the way through) */
const FADE = "[data-travel-fade]";

/** undo a pull-back (a page restored from a cache, or a run that never navigated) */
export function resetPullBack() {
  for (const el of document.querySelectorAll<HTMLElement>(FADE)) {
    el.style.transition = el.style.transform = el.style.opacity = el.style.transformOrigin = "";
    el.inert = false;
  }
}

function pullBack(ms: number) {
  // (the words leave first, the zoom easing in behind them)
  const ease = "cubic-bezier(0.3, 0, 0.2, 1)";
  for (const el of document.querySelectorAll<HTMLElement>(FADE)) {
    el.style.transition = `transform ${ms}ms ${ease}, opacity ${Math.round(ms * 0.6)}ms ${ease}`;
    el.style.transformOrigin = "50% 40%";
    el.style.transform = "scale(0.97)";
    el.style.opacity = "0";
    el.inert = true;
  }
}

/** the night layer the film hands over to (made fresh for each run, removed once the next page is in) */
function nightLayer(): HTMLDivElement {
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  const night = getComputedStyle(document.documentElement).getPropertyValue("--night").trim() || "#121214";
  box.style.cssText = `position:fixed;inset:0;z-index:80;opacity:0;pointer-events:auto;background:${night}`;
  document.body.appendChild(box);
  return box;
}

/** the next page is in: the dark fades as the page emerges (TravelFocus calls this on every navigation) */
export function arrive() {
  const box = overlay;
  if (!box) return;
  overlay = null;
  window.clearTimeout(failsafe);
  box.style.transition = `opacity ${EMERGE_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
  box.style.pointerEvents = "none";
  requestAnimationFrame(() => (box.style.opacity = "0"));
  window.setTimeout(() => {
    box.remove();
    delete document.documentElement.dataset.arrive;
    busy = false;
  }, EMERGE_MS + 80);
}

export function travel(router: Router, href: string, kind: TravelKind) {
  if (busy) return;
  markTravel();
  router.prefetch(href);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("startViewTransition" in document)) {
    // (reduced motion: the travel type's 150 ms crossfade; no view transitions: a plain navigation)
    router.push(href, reduce ? { transitionTypes: [TRAVEL] } : undefined);
    return;
  }
  const dark = nightLayer();
  const covered = () => {
    // the page emerges as it mounts (globals.css: html[data-arrive] .cc-page), and the night fades the moment it's in
    // (not on the route's effects, which can land a few hundred ms after the page is on screen)
    document.documentElement.dataset.arrive = "";
    const old = document.querySelector(".cc-page");
    const watch = new MutationObserver(() => {
      const now = document.querySelector(".cc-page");
      if (now && now !== old) {
        watch.disconnect();
        arrive();
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    router.push(href);
    // (if the navigation never lands, don't leave the screen dark)
    failsafe = window.setTimeout(() => {
      watch.disconnect();
      arrive();
      resetPullBack();
    }, 4000);
  };
  if (!runner?.(kind, ZOOM_MS, dark, covered)) {
    // (the hero isn't on screen: the arrival only)
    dark.remove();
    router.push(href, { transitionTypes: [TRAVEL] });
    return;
  }
  busy = true;
  overlay = dark;
  pullBack(ZOOM_MS);
}
