"use client";
// A link that arrives the way the hero's choices do, minus the film: the next page comes in from a little depth, its
// heading first, and takes the focus (lib/travel.ts). For the header's Market and Join.

import Link from "next/link";
import type { ComponentProps } from "react";
import { TRAVEL, markTravel } from "@/lib/travel";

export function TravelLink({ onClick, ...rest }: Omit<ComponentProps<typeof Link>, "transitionTypes">) {
  return (
    <Link
      {...rest}
      transitionTypes={[TRAVEL]}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) markTravel();
      }}
    />
  );
}
