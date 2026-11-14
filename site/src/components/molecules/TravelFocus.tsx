"use client";
// After a travel navigation (lib/travel.ts) the new page's first heading takes the focus, so keyboard and screen-reader
// users start where the eye does, and a run into the film ends (the night fades). Coming back to the landing with
// the browser's back or forward button, it fades in (220 ms, globals.css: html[data-back]). Other navigations keep the
// browser's own focus handling.

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { arrive, takeTravelFocus } from "@/lib/travel";

export function TravelFocus() {
  const path = usePathname();
  // back / forward to the landing: it fades in as it mounts (only its wrapper matches, so the page you leave doesn't)
  useEffect(() => {
    let off = 0;
    const onPop = () => {
      if (window.location.pathname !== "/") return;
      document.documentElement.dataset.back = "";
      window.clearTimeout(off);
      off = window.setTimeout(() => delete document.documentElement.dataset.back, 600);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.clearTimeout(off);
    };
  }, []);

  useEffect(() => {
    // (a run into the film ends here at the latest: the night fades as the new page emerges)
    arrive();
    if (!takeTravelFocus()) return;
    // (the heading may mount a moment later, e.g. the market's once its first read is in: look for up to a second)
    let raf = 0;
    const t0 = performance.now();
    const find = () => {
      const h = document.querySelector<HTMLElement>("main h1");
      if (h) {
        if (!h.hasAttribute("tabindex")) h.tabIndex = -1;
        h.focus({ preventScroll: true });
      } else if (performance.now() - t0 < 1000) raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [path]);
  return null;
}
