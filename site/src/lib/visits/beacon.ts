"use client";
// The browser side of the visit counter (lib/visits/record.ts): a fire-and-forget POST to /api/v. No cookies, no id,
// nothing stored on the device. A video capture (?capture=1) sends nothing.

export function beacon(body: { event: "view"; path: string; ref: string } | { event: "video"; step: string }) {
  try {
    if (new URLSearchParams(window.location.search).get("capture") === "1") return;
    const data = JSON.stringify(body);
    if (navigator.sendBeacon?.("/api/v", new Blob([data], { type: "application/json" }))) return;
    void fetch("/api/v", { method: "POST", body: data, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  } catch {
    /* counting never gets in the way */
  }
}
