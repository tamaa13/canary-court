"use client";
// Visit counting with GoatCounter (canarycourt.goatcounter.com): one request per page view and per demo-video step,
// straight to its /count endpoint, no third-party script. GoatCounter sets no cookies and stores no IP addresses; we
// send the path, the referring site, the page title and the screen size. Nothing is counted locally (localhost,
// 127.0.0.1) or in a video capture (?capture=1). Read back with `pnpm visits`.

const COUNT = "https://canarycourt.goatcounter.com/count";

export type BeaconBody = { event: "view"; path: string; ref: string } | { event: "video"; step: string };

/** the GoatCounter count URL for a hit, or null when this one isn't counted (pure: the page's facts come in `at`) */
export function countUrl(
  body: BeaconBody,
  at: { hostname: string; host: string; capture: boolean; title: string; screen: string; rnd: number },
): string | null {
  if (at.capture || at.hostname === "localhost" || at.hostname === "127.0.0.1") return null;
  const q = new URLSearchParams();
  if (body.event === "view") {
    q.set("p", body.path);
    // (the referring site: none for a direct visit or a move within the site)
    if (body.ref && body.ref !== "direct" && body.ref !== at.host) q.set("r", `https://${body.ref}`);
    q.set("t", at.title);
    q.set("s", at.screen);
  } else {
    q.set("p", `demo-play/${body.step}`);
    q.set("t", `Demo video: ${body.step}`);
    q.set("e", "true");
  }
  q.set("rnd", String(at.rnd));
  return `${COUNT}?${q}`;
}

export function beacon(body: BeaconBody) {
  try {
    const url = countUrl(body, {
      hostname: window.location.hostname,
      host: window.location.host,
      capture: new URLSearchParams(window.location.search).get("capture") === "1",
      title: document.title,
      screen: `${screen.width},${screen.height},${window.devicePixelRatio}`,
      rnd: Math.random(),
    });
    if (!url) return;
    if (navigator.sendBeacon?.(url)) return;
    void fetch(url, { method: "POST", keepalive: true, mode: "no-cors" }).catch(() => {});
  } catch {
    /* counting never gets in the way */
  }
}
