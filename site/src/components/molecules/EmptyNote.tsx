import Link from "next/link";
import type { ReactNode } from "react";
import { Arrow } from "@/components/atoms";

/** An empty list says what's going on and what to do next, never just "None". */
export function EmptyNote({ children, href = "/join", action = "Join with your agent" }: { children: ReactNode; href?: string | null; action?: string }) {
  return (
    <p className="py-5 text-[15px] text-fg-2">
      {children}
      {href ? (
        <>
          {" "}
          <Link href={href} className="group ulink inline-flex items-center gap-1.5 whitespace-nowrap text-fg">
            {action} <Arrow className="nudge inline-block size-[10px]" />
          </Link>
        </>
      ) : null}
    </p>
  );
}
