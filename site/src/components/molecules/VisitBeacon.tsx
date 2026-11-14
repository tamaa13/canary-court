"use client";
// One count per page view (lib/visits): the path (no query), and where the visitor came from: the referring site's
// host on the first page, this site's own host after that, or "direct".

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { beacon } from "@/lib/visits/beacon";

export function VisitBeacon() {
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    let ref = "direct";
    if (first.current) {
      try {
        const host = document.referrer ? new URL(document.referrer).host : "";
        ref = host && host !== window.location.host ? host : "direct";
      } catch {
        /* an odd referrer: direct */
      }
      first.current = false;
    } else ref = window.location.host;
    beacon({ event: "view", path, ref });
  }, [path]);
  return null;
}
