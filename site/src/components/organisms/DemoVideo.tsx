"use client";
// The demo video: the browser's own player (controls, plays inline, only its metadata loads up front), and the funnel
// we count for it (lib/visits): play, a quarter, half, three quarters, the end. Each step once per page view.

import { useRef } from "react";
import { beacon } from "@/lib/visits/beacon";

export function DemoVideo({ src, poster, w, h }: { src: string; poster: string; w: number; h: number }) {
  const sent = useRef(new Set<string>());
  const once = (step: string) => {
    if (sent.current.has(step)) return;
    sent.current.add(step);
    beacon({ event: "video", step });
  };
  return (
    <video
      controls
      playsInline
      preload="metadata"
      poster={poster}
      width={w}
      height={h}
      className="block h-auto w-full bg-[var(--night)]"
      onPlay={() => once("play")}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (!v.duration) return;
        const p = v.currentTime / v.duration;
        for (const q of [25, 50, 75]) if (p >= q / 100) once(String(q));
      }}
      onEnded={() => once("ended")}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
