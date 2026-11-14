"use client";
// A link that leaves through the hero's film when the hero is on screen (lib/travel.ts), with the arrival only anywhere
// else. A modified click (new tab, etc.) is left to the browser.

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { travel } from "@/lib/travel";

export function PortalLink({ href, onClick, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        travel(router, href, href.startsWith("/join") ? "join" : "market");
      }}
    />
  );
}
